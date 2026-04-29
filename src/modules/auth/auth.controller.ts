import { Controller, Get, Post, Body, HttpException, HttpStatus, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';

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

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'user:email repo',
    });

    const githubUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    console.log('Redirecting to GitHub:', githubUrl);
    return res.redirect(githubUrl);
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
    if (!code) {
      throw new HttpException('No code provided', HttpStatus.BAD_REQUEST);
    }

    try {
      const { user, token } = await this.authService.githubLogin(code);

      // Deep link back into the app — path must match Linking.createURL('/(auth)/github')
      const deepLinkUrl = `pocktdev:///(auth)/github?token=${token}&userId=${user.id}`;

      // Use an HTML page with a JS redirect instead of res.redirect() (HTTP 302).
      // Android Chrome Custom Tabs silently ignore 302 redirects to custom URL
      // schemes (pocktdev://), but window.location.href triggers the intent
      // filter correctly and lets openAuthSessionAsync intercept the return.
      return res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Redirecting to PocketDev...</title>
    <meta http-equiv="refresh" content="0;url=${deepLinkUrl}" />
  </head>
  <body>
    <p>Redirecting back to PocketDev...</p>
    <script>window.location.href = "${deepLinkUrl}";</script>
  </body>
</html>`);
    } catch (error) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
  }

  @Post('logout')
  async logout(@Body('userId') userId: string) {
    if (!userId) {
      throw new HttpException('User ID required', HttpStatus.BAD_REQUEST);
    }
    try {
      await this.authService.logout(userId);
      return { message: 'Logged out successfully' };
    } catch (error) {
      throw new HttpException('Logout failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
