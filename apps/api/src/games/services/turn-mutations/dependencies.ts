import type { AuthService } from '../../../auth/auth.service';
import type { BotNotificationsService } from '../../bot-notifications.service';
import type { FileStorageService } from '../../file-storage.service';

/** Effects used by mutations; only transactional outbox writes run inside transactions. */
export type TurnMutationDependencies = {
  authService?: Pick<AuthService, 'isUserShadowOverride'>;
  fileStorage?: Pick<FileStorageService, 'stageUpload' | 'removeFileOrThrow'>;
  botNotifications?: Pick<
    BotNotificationsService,
    'notifySaveUploaded' | 'notifyGameInitialized' | 'notifyThreadRenamed'
  > &
    Partial<Pick<BotNotificationsService, 'enqueueActivePlayerChanged'>>;
};
