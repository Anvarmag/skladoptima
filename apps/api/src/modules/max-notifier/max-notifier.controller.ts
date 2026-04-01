import { Controller, Post, Body, Get, BadRequestException } from '@nestjs/common';
import { MaxNotifierService } from './max-notifier.service';
import { Public } from '../auth/public.decorator';

@Controller('max-notifier')
export class MaxNotifierController {
  constructor(private readonly maxNotifierService: MaxNotifierService) {}

  @Public() // Allow testing without JWT for now
  @Get('validate')
  async validate() {
    const isValid = await this.maxNotifierService.validateToken();
    return { success: isValid, message: isValid ? 'Token is valid' : 'Token validation failed' };
  }

  @Public()
  @Post('test')
  async test(@Body() body: { chatId?: string, text?: string }) {
    const chatId = body.chatId || process.env.MAX_CHAT_ID;
    const text = body.text || 'Тест Skladoptima: интеграция с MAX работает';

    if (!chatId) {
      throw new BadRequestException('chatId is required (either in body or MAX_CHAT_ID env)');
    }

    const success = await this.maxNotifierService.sendMessage(chatId, text);
    return { success, message: success ? 'Test message sent' : 'Failed to send test message' };
  }
}
