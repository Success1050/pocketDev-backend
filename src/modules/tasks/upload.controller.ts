import { Controller, Post, Get, Param, Res, Req, UseInterceptors, UploadedFile, BadRequestException, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response, Request } from 'express';
import { existsSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import AdmZip = require('adm-zip');

@Controller('tasks/upload')
export class UploadController {
  @Post()
  @UseInterceptors(FileInterceptor('file')) // Uses MemoryStorage by default
  async uploadFile(@UploadedFile() file: any, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Process all files (ZIPs, Images, etc) locally
    let envContent = '';
    
    try {
      // Parse the ZIP buffer to search for .env files
      const zip = new AdmZip(file.buffer);
      const zipEntries = zip.getEntries();
      
      // Look for a .env or .env.local file in the root directory
      const envEntry = zipEntries.find(entry => {
        // If it's directly in the root or inside exactly one top-level directory
        const isEnvFile = entry.name === '.env' || entry.name === '.env.local';
        return isEnvFile;
      });

      if (envEntry) {
        envContent = envEntry.getData().toString('utf8');
      }
    } catch (e) {
      console.warn("Failed to parse zip for .env file", e.message);
    }

    // Save the file locally
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await fsPromises.mkdir(uploadDir, { recursive: true });
    }
    
    // Generate a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const originalExt = file.originalname && file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '.zip';
    const filename = `upload-${uniqueSuffix}${originalExt}`;
    const filePath = join(uploadDir, filename);

    await fsPromises.writeFile(filePath, file.buffer);

    // Return local URL using the incoming request's host and protocol
    const protocol = req.protocol;
    const host = req.get('host') || 'localhost:8080';
    const uploadUrl = `${protocol}://${host}/tasks/upload/${filename}`;

    return { url: uploadUrl, envContent };
  }

  @Get(':filename')
  getFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = join(process.cwd(), 'uploads', filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException();
    }
    res.sendFile(filePath);
  }
}
