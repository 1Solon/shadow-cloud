import { Module } from '@nestjs/common';
import { CompanionProtocolController } from './companion/protocol.controller';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { GamesModule } from './games/games.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    AuthModule,
    GamesModule,
  ],
  controllers: [AppController, CompanionProtocolController],
  providers: [AppService],
})
export class AppModule {}
