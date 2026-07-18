import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((req: any, res: any, next: any) => {
    console.log(`[REQ] ${req.method} ${req.originalUrl}`);
    next();
  });
  const configService = app.get(ConfigService);
  app.enableCors({
    origin: [configService.get<string>('FRONTEND_URL') || 'http://localhost:3001', 'http://localhost:3000', 'pocktdev://'],
    credentials: true,
  });
  await app.listen(configService.get<string>('PORT') ?? 8080);
}
bootstrap();
