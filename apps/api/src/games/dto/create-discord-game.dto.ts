import {
  Max,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum CreateDiscordGameDlcMode {
  NONE = 'NONE',
  OCEANIA = 'OCEANIA',
  REPUBLICA = 'REPUBLICA',
  BOTH = 'BOTH',
}

export enum CreateDiscordGameMode {
  TEAMS = 'TEAMS',
  TEAMS_AI = 'TEAMS_AI',
  FFA = 'FFA',
  FFA_AI = 'FFA_AI',
}

export enum CreateDiscordGameZoneCount {
  CITY_STATE = 'CITY_STATE',
  TWO_ZONE_START = 'TWO_ZONE_START',
  THREE_ZONE_START = 'THREE_ZONE_START',
}

export enum CreateDiscordGameArmyCount {
  MILITIA_ONLY = 'MILITIA_ONLY',
  ONE_PER_ZONE = 'ONE_PER_ZONE',
  TWO_PER_ZONE = 'TWO_PER_ZONE',
}

export class CreateDiscordGameDto {
  @IsInt()
  @Min(1)
  gameNumber!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

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
  @MaxLength(100)
  slug?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  organizerDiscordId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  organizerDisplayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  organizerUsername?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  discordGuildId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  discordChannelId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  discordThreadId!: string;
}
