import { Injectable, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import axios from 'axios';
import * as jose from 'jose';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async githubLogin(code: string) {
    try {
      // 1. Exchange code for access token using GitHub App credentials
      const tokenResponse = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        },
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        throw new UnauthorizedException('Failed to obtain access token from GitHub');
      }

      // 2. Fetch user profile from GitHub
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const { id, login, avatar_url } = userResponse.data;
      const githubId = String(id);

      // 3. Upsert User in Database
      const user = await this.prisma.user.upsert({
        where: { githubId },
        update: {
          username: login,
          avatar: avatar_url,
          accessToken, // Updating access token linked to GitHub App authorization
        },
        create: {
          githubId,
          username: login,
          avatar: avatar_url,
          accessToken,
        },
      });

      // 4. Generate internal JWT using jose
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-default');
      const alg = 'HS256';

      const jwt = await new jose.SignJWT({ sub: user.id, username: user.username })
        .setProtectedHeader({ alg })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(secret);

      return {
        user,
        token: jwt,
      };
    } catch (error) {
      console.error('Github auth error:', error.response?.data || error.message);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  async getRepositories(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.accessToken) {
      throw new UnauthorizedException('User not found or not connected to GitHub');
    }

    try {
      const response = await axios.get('https://api.github.com/user/repos', {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
        params: {
          sort: 'updated',
          per_page: 50,
        },
      });

      return response.data.map((repo: any) => ({
        name: repo.name,
        lang: repo.language || 'Unknown',
        stars: repo.stargazers_count,
        private: repo.private,
        description: repo.description,
      }));
    } catch (error) {
      console.error('Fetch repos error:', error.response?.data || error.message);
      throw new HttpException('Failed to fetch repositories', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
