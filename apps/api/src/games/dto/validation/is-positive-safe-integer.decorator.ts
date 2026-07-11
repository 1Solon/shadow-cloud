import { registerDecorator, type ValidationOptions } from 'class-validator';
import { MAX_TURN_TIMING_HOURS } from '../../support/turn-timing';

export function IsPositiveSafeInteger(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPositiveSafeInteger',
      target: object.constructor,
      propertyName,
      options: {
        message: `must be a whole number of hours between 1 and ${MAX_TURN_TIMING_HOURS}`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value >= 1 &&
            value <= MAX_TURN_TIMING_HOURS
          );
        },
      },
    });
  };
}
