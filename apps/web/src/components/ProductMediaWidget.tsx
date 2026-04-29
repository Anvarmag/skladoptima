import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Package, Upload, RefreshCw, Trash2 } from 'lucide-react';

type UploadState = 'idle' | 'uploading' | 'confirming' | 'deleting' | 'error';

interface Props {
    productId: string;
    mainImageFileId: string | null;
    legacyPhotoUrl: string | null;
    isReadOnly: boolean;
    onMediaUpdated: (newFileId: string | null) => void;
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export default function ProductMediaWidget({
    productId,
    mainImageFileId,
    legacyPhotoUrl,
    isReadOnly,
    onMediaUpdated,
}: Props) {
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [uploadState, setUploadState] = useState<UploadState>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [hovered, setHovered] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch signed URL whenever mainImageFileId changes
    useEffect(() => {
        if (!mainImageFileId) {
            setSignedUrl(null);
            return;
        }
        let cancelled = false;
        axios
            .get(`/files/${mainImageFileId}/access-url`)
            .then((res) => {
                if (!cancelled) setSignedUrl(res.data.accessUrl);
            })
            .catch(() => {
                if (!cancelled) setSignedUrl(null);
            });
        return () => {
            cancelled = true;
        };
    }, [mainImageFileId]);

    const displayUrl = signedUrl ?? normalizeLegacyUrl(legacyPhotoUrl);
    const hasFileApiImage = !!mainImageFileId;
    const isProcessing =
        uploadState === 'uploading' ||
        uploadState === 'confirming' ||
        uploadState === 'deleting';

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file) return;

        const normalizedMime = file.type.toLowerCase();

        if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
            setErrorMsg('Формат не поддерживается. Используйте JPG, PNG или WebP.');
            setUploadState('error');
            return;
        }
        if (file.size > MAX_SIZE_BYTES) {
            setErrorMsg('Файл слишком большой. Максимум 10 МБ.');
            setUploadState('error');
            return;
        }

        setErrorMsg(null);
        setUploadState('uploading');

        try {
            // Step 1: request presigned PUT URL
            const { data: uploadData } = await axios.post('/files/upload-url', {
                entityType: 'product_main_image',
                entityId: productId,
                mimeType: normalizedMime,
                sizeBytes: file.size,
                originalFilename: file.name,
            });
            const { fileId, uploadUrl } = uploadData;

            // Step 2: PUT file directly to S3 (bypass axios interceptors — use fetch)
            const putRes = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': normalizedMime },
            });
            if (!putRes.ok) {
                throw new Error(`S3 upload failed: ${putRes.status}`);
            }

            // Step 3: confirm
            setUploadState('confirming');
            await axios.post('/files/confirm', { fileId });

            setUploadState('idle');
            onMediaUpdated(fileId);
        } catch (err: any) {
            const code = err?.response?.data?.code;
            let msg = 'Ошибка загрузки. Попробуйте снова.';
            if (code === 'FILE_FORMAT_NOT_ALLOWED') msg = 'Формат не поддерживается.';
            else if (code === 'FILE_TOO_LARGE') msg = 'Файл слишком большой (макс. 10 МБ).';
            else if (code === 'FILE_WRITE_FORBIDDEN' || code === 'FILE_WRITE_BLOCKED_BY_TENANT_STATE')
                msg = 'Загрузка недоступна в текущем состоянии аккаунта.';
            setErrorMsg(msg);
            setUploadState('error');
        }
    };

    const handleDelete = async () => {
        if (!mainImageFileId) return;
        if (!window.confirm('Удалить фото товара?')) return;
        setUploadState('deleting');
        try {
            await axios.delete(`/files/${mainImageFileId}`);
            setSignedUrl(null);
            setUploadState('idle');
            onMediaUpdated(null);
        } catch {
            setErrorMsg('Ошибка удаления. Попробуйте снова.');
            setUploadState('error');
        }
    };

    return (
        <div
            className="relative w-full h-full"
            onMouseEnter={() => !isReadOnly && setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Image or placeholder */}
            <div className="w-full h-full rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                {isProcessing ? (
                    <div className="flex flex-col items-center gap-1 text-slate-500 text-center px-1">
                        <RefreshCw className="h-5 w-5 animate-spin flex-shrink-0" />
                        <span className="text-[10px] leading-tight">
                            {uploadState === 'uploading'
                                ? 'Загрузка...'
                                : uploadState === 'confirming'
                                ? 'Проверка...'
                                : 'Удаление...'}
                        </span>
                    </div>
                ) : uploadState === 'error' ? (
                    <div className="flex flex-col items-center gap-1 text-center px-2">
                        <span className="text-[10px] text-red-600 leading-tight">{errorMsg}</span>
                        <button
                            onClick={() => setUploadState('idle')}
                            className="text-[10px] text-blue-500 underline"
                        >
                            Закрыть
                        </button>
                    </div>
                ) : displayUrl ? (
                    <img src={displayUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                    <Package className="h-6 w-6 sm:h-8 sm:w-8 text-slate-400" />
                )}
            </div>

            {/* Hover overlay with actions (write-allowed only) */}
            {!isReadOnly && !isProcessing && uploadState !== 'error' && hovered && (
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 rounded-lg">
                    {displayUrl ? (
                        <>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-1.5 bg-white/90 rounded-md text-slate-700 hover:bg-white transition-colors"
                                title="Заменить фото"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            {hasFileApiImage && (
                                <button
                                    onClick={handleDelete}
                                    className="p-1.5 bg-white/90 rounded-md text-red-600 hover:bg-white transition-colors"
                                    title="Удалить фото"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="p-1.5 bg-white/90 rounded-md text-slate-700 hover:bg-white transition-colors"
                            title="Загрузить фото"
                        >
                            <Upload className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            )}

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelect}
            />
        </div>
    );
}

function normalizeLegacyUrl(path: string | null): string | null {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return path.startsWith('/') ? path : `/${path}`;
}
