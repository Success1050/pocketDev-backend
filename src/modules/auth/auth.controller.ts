import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Get('github/login')
  async githubLogin(@Res() res: Response) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = process.env.GITHUB_CALLBACK_URL;

    if (!clientId || !redirectUri) {
      throw new HttpException('GitHub configuration missing', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user:email`;
    return res.redirect(githubUrl);
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
    if (!code) {
      throw new HttpException('No code provided', HttpStatus.BAD_REQUEST);
    }

    try {
      const { user, token } = await this.authService.githubLogin(code);

      // We redirect back to the React Native App via deep link.
      // E.g., pocketdev://login?token=xyz
      // For local testing, you can change this to your Expo URI
      const deepLinkUrl = `pocketdev://login?token=${token}&userId=${user.id}`;
      return res.redirect(deepLinkUrl);
    } catch (error) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
  }
}
