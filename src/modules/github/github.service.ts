import { Injectable, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class GithubService {
  constructor(private prisma: PrismaService) { }

  async getRepositories(userId: string, page: number = 1, perPage: number = 20) {
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
          page,
          per_page: perPage,
        },
      });

      return response.data.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        owner: repo.owner.login,
        lang: repo.language || 'Unknown',
        stars: repo.stargazers_count,
        private: repo.private,
        description: repo.description,
        defaultBranch: repo.default_branch,
      }));
    } catch (error) {
      console.error('Fetch repos error:', error.response?.data || error.message);
      throw new HttpException('Failed to fetch repositories', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getBranches(userId: string, owner: string, repo: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.accessToken) {
      throw new UnauthorizedException('User not found or not connected to GitHub');
    }

    try {
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
      });

      return response.data.map((branch: any) => branch.name);
    } catch (error) {
      console.error('Fetch branches error:', error.response?.data || error.message);
      throw new HttpException('Failed to fetch branches', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createBranch(userId: string, owner: string, repo: string, branchName: string, baseBranch: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.accessToken) {
      throw new UnauthorizedException('User not found or not connected to GitHub');
    }

    try {
      // 1. Get the SHA of the base branch
      const baseBranchResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
      });

      const sha = baseBranchResponse.data.object.sha;

      // 2. Create the new branch
      const response = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        ref: `refs/heads/${branchName}`,
        sha,
      }, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Create branch error:', error.response?.data || error.message);
      throw new HttpException('Failed to create branch', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
