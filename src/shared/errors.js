export class DomainValidationError extends Error {
  constructor(message, field = null, code = 'INVALID_VALUE') {
    super(message);
    this.name = 'DomainValidationError';
    this.field = field;
    this.code = code;
  }
}
