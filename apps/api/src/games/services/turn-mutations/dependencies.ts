import type { AuthService } from '../../../auth/auth.service';
import type { BotNotificationsService } from '../../bot-notifications.service';
import type { FileStorageService } from '../../file-storage.service';

/** External effects used by the mutation module, never inside its transactions. */
export type TurnMutationDependencies = {
  authService?: Pick<AuthService, 'isUserShadowOverride'>;
  fileStorage?: Pick<FileStorageService, 'stageUpload' | 'removeFile'>;
  botNotifications?: Pick<
    BotNotificationsService,
    'notifySaveUploaded' | 'notifyGameInitialized' | 'notifyThreadRenamed'
  >;
};
