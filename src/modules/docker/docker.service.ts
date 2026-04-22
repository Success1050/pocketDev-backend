import { Injectable } from '@nestjs/common';

@Injectable()
export class DockerService {
  async spinUpWorkspace(repoUrl: string) {
    // Docker SDK logic to spin up isolated container
    console.log(`Spinning up workspace for: ${repoUrl}`);
    return { containerId: 'mock-container-123' };
  }
}
