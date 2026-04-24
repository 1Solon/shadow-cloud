import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CreateDiscordGameArmyCount,
  CreateDiscordGameDlcMode,
  CreateDiscordGameMode,
  CreateDiscordGameZoneCount,
} from './create-discord-game.dto';

export class UpdateGameMetadataDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  gameNumber?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roundNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  playerCount?: number;

  @IsOptional()
  @IsBoolean()
  hasAiPlayers?: boolean;

  @IsOptional()
  @IsEnum(CreateDiscordGameDlcMode)
  dlcMode?: CreateDiscordGameDlcMode;

  @IsOptional()
  @IsEnum(CreateDiscordGameMode)
  gameMode?: CreateDiscordGameMode;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(5)
  techLevel?: number;

  @IsOptional()
  @IsEnum(CreateDiscordGameZoneCount)
  zoneCount?: CreateDiscordGameZoneCount;

  @IsOptional()
  @IsEnum(CreateDiscordGameArmyCount)
  armyCount?: CreateDiscordGameArmyCount;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
