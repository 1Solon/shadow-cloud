import { registerDecorator, type ValidationOptions } from 'class-validator';
import {
  CAMPAIGN_TAGLINE_MAX_LENGTH,
  isValidCampaignTagline,
} from '../../support/game-configuration.helpers';

export function IsCampaignTagline(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isCampaignTagline',
      target: object.constructor,
      propertyName,
      options: {
        message: `must be a single line of at most ${CAMPAIGN_TAGLINE_MAX_LENGTH} characters`,
        ...validationOptions,
      },
      validator: {
        validate: isValidCampaignTagline,
      },
    });
  };
}
