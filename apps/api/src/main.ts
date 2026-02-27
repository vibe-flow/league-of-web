import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { cleanupOpenApiDoc } from 'nestjs-zod'
import * as pino from 'pino'
import { AppModule } from './app.module'
import { TrpcRouter } from './trpc/trpc.router'
import { GameWebSocketServer } from './modules/game/game.gateway'

async function bootstrap() {
  const logger = pino.default({
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  })

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  })

  const configService = app.get(ConfigService)
  const port = configService.get('PORT', 3000)

  // CORS
  app.enableCors({
    origin: (origin, callback) => {
      // Allow localhost and ngrok URLs
      if (!origin || origin.includes('localhost') || origin.includes('ngrok')) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    },
    credentials: true,
  })

  // Global prefix
  app.setGlobalPrefix('api')

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Template Dev API')
    .setDescription('Full-stack template API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  const cleanedDocument = cleanupOpenApiDoc(document)
  SwaggerModule.setup('api/docs', app, cleanedDocument)

  // tRPC
  const trpc = app.get(TrpcRouter)
  await trpc.applyMiddleware(app)

  await app.listen(port)

  // Attach WebSocket server to the HTTP server
  const httpServer = app.getHttpServer()
  const wsServer = app.get(GameWebSocketServer)
  wsServer.attach(httpServer)

  Logger.log(`🚀 Application is running on: http://localhost:${port}/api`)
  Logger.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`)
  Logger.log(`🔌 tRPC endpoint: http://localhost:${port}/trpc`)
  Logger.log(`🎮 WebSocket game server: ws://localhost:${port}/game`)
}

bootstrap()
