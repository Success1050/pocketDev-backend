import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { GithubService } from './github.service';

@Controller('github')
export class GithubController {
  constructor(private readonly githubService: GithubService) { }

  @Get('repos/:userId')
  async getRepos(
    @Param('userId') userId: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.githubService.getRepositories(userId, page, perPage);
  }

  @Get('repos/:userId/:owner/:repo/branches')
  async getBranches(
    @Param('userId') userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.githubService.getBranches(userId, owner, repo);
  }

  @Post('repos/:userId/:owner/:repo/branches')
  async createBranch(
    @Param('userId') userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: { branchName: string; baseBranch: string },
  ) {
    return this.githubService.createBranch(userId, owner, repo, body.branchName, body.baseBranch);
  }
}
