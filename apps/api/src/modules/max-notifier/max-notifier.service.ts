import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class MaxNotifierService {
  private readonly logger = new Logger(MaxNotifierService.name);
  private readonly apiClient: AxiosInstance;
  private readonly baseUrl = 'https://platform-api.max.ru';

  constructor() {
    const token = process.env.MAX_BOT_TOKEN;
    const isEnabled = process.env.MAX_ENABLED === 'true';

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    if (!isEnabled) {
      this.logger.warn('MAX Notifier is DISABLED (MAX_ENABLED=false)');
    }
  }

  async validateToken(): Promise<boolean> {
    if (process.env.MAX_ENABLED !== 'true') return false;
    
    try {
      this.logger.log('Validating MAX Bot Token...');
      const response = await this.apiClient.get('/me');
      if (response.status === 200) {
        this.logger.log('MAX Bot Token is VALID');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`MAX Token Validation Failed: ${error.message}`);
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      return false;
    }
  }

  async sendMessage(chatId: string, text: string, retryCount = 3): Promise<boolean> {
    if (process.env.MAX_ENABLED !== 'true') {
        this.logger.warn(`Skipping message sending (MAX_ENABLED=false). Content: ${text}`);
        return false;
    }

    const payload = { chatId, text };

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        this.logger.log(`Sending message to MAX (Attempt ${attempt}/${retryCount})...`);
        const response = await this.apiClient.post('/messages', payload);
        
        if (response.status === 200 || response.status === 201) {
          this.logger.log(`Message successfully sent to chat ${chatId}`);
          return true;
        }
      } catch (error) {
        this.logger.error(`Attempt ${attempt} failed: ${error.message}`);
        if (attempt === retryCount) {
          this.logger.error(`MAX Message Sending Failed after ${retryCount} attempts.`);
        } else {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    return false;
  }
}
