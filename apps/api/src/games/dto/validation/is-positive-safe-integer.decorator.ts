import { registerDecorator, type ValidationOptions } from 'class-validator';

export function IsPositiveSafeInteger(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPositiveSafeInteger',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value > 0
          );
        },
      },
    });
  };
}
