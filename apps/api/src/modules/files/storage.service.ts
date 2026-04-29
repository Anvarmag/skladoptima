import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface HeadResult {
    contentLength:  number;
    contentType:    string | undefined;
    checksumSha256: string | undefined;
}

/**
 * Обёртка над S3-совместимым объектным хранилищем.
 *
 * Конфигурация через env:
 *   STORAGE_S3_ENDPOINT   — URL хранилища (MinIO для local dev, пусто = AWS)
 *   STORAGE_S3_REGION     — регион (default: us-east-1)
 *   STORAGE_S3_BUCKET     — имя bucket
 *   STORAGE_S3_ACCESS_KEY — access key
 *   STORAGE_S3_SECRET_KEY — secret key
 */
@Injectable()
export class StorageService {
    private readonly logger = new Logger(StorageService.name);
    private readonly client: S3Client;
    readonly bucket: string;

    constructor() {
        const endpoint  = process.env.STORAGE_S3_ENDPOINT;
        const region    = process.env.STORAGE_S3_REGION    ?? 'us-east-1';
        const accessKey = process.env.STORAGE_S3_ACCESS_KEY;
        const secretKey = process.env.STORAGE_S3_SECRET_KEY;
        this.bucket     = process.env.STORAGE_S3_BUCKET    ?? 'skladoptima';

        this.client = new S3Client({
            region,
            // forcePathStyle нужен для MinIO и совместимых хранилищ
            ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
            ...(accessKey && secretKey
                ? { credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } }
                : {}),
        });
    }

    /**
     * Создаёт presigned PUT URL для прямой загрузки клиентом в S3.
     * Content-Type задаётся на этапе выдачи URL — клиент ОБЯЗАН передать его в заголовке.
     */
    async presignedPutUrl(objectKey: string, mimeType: string, expiresInSec: number): Promise<string> {
        const command = new PutObjectCommand({
            Bucket:      this.bucket,
            Key:         objectKey,
            ContentType: mimeType,
        });
        return getSignedUrl(this.client, command, { expiresIn: expiresInSec });
    }

    /**
     * Создаёт presigned GET URL для чтения объекта клиентом.
     * URL живёт короткий TTL и не используется как постоянная публичная ссылка.
     */
    async presignedGetUrl(objectKey: string, expiresInSec: number): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key:    objectKey,
        });
        return getSignedUrl(this.client, command, { expiresIn: expiresInSec });
    }

    /**
     * Физически удаляет объект из S3. Возвращает true при успехе или если объект уже не существует.
     * Бросает исключение при других ошибках хранилища.
     */
    async deleteObject(objectKey: string): Promise<boolean> {
        try {
            const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey });
            await this.client.send(command);
            this.logger.log(JSON.stringify({
                metric: 'storage_delete_success',
                key:    objectKey,
                ts:     new Date().toISOString(),
            }));
            return true;
        } catch (err: any) {
            const status = err?.$metadata?.httpStatusCode;
            if (status === 404 || err?.name === 'NotFound') return true;
            this.logger.error(JSON.stringify({
                metric: 'storage_delete_error',
                key:    objectKey,
                error:  err?.message ?? String(err),
                ts:     new Date().toISOString(),
            }));
            throw err;
        }
    }

    /**
     * Запрашивает metadata объекта в S3 без загрузки тела.
     * Возвращает null, если объект не найден (HTTP 404).
     * Бросает исключение при других ошибках хранилища.
     */
    async headObject(objectKey: string): Promise<HeadResult | null> {
        try {
            const command = new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey });
            const result  = await this.client.send(command);
            this.logger.log(JSON.stringify({
                metric:    'storage_head_success',
                key:       objectKey,
                sizeBytes: result.ContentLength,
                ts:        new Date().toISOString(),
            }));
            return {
                contentLength:  result.ContentLength   ?? 0,
                contentType:    result.ContentType,
                checksumSha256: result.ChecksumSHA256,
            };
        } catch (err: any) {
            const status = err?.$metadata?.httpStatusCode;
            if (status === 404 || err?.name === 'NotFound') return null;
            this.logger.error(JSON.stringify({
                metric: 'storage_head_error',
                key:    objectKey,
                error:  err?.message ?? String(err),
                ts:     new Date().toISOString(),
            }));
            throw err;
        }
    }
}
