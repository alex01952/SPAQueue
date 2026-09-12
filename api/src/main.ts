import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';

config({ path: join(__dirname, '..', '.env') });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({
    origin: 'http://localhost:4200',
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-dashboard-password'],
  });

  const frontendPath = join(__dirname, '..', 'public');
  const frontendIndexPath = join(frontendPath, 'index.html');

  if (existsSync(frontendIndexPath)) {
    app.useStaticAssets(frontendPath);
    app.use((request, response, next) => {
      const isApiRoute =
        /^(\/queue|\/participation|\/players|\/games)(\/|$)/.test(request.path);

      if (request.method !== 'GET' || isApiRoute) {
        next();
        return;
      }

      response.sendFile(frontendIndexPath);
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
