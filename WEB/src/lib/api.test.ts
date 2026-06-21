import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './api';

describe('api', () => {
  it('[getErrorMessage] должен вернуть fallback, когда ошибка null или undefined', () => {
    // Arrange
    const fallback = 'Fallback';

    // Act
    const nullResult = getErrorMessage(null, fallback);
    const undefinedResult = getErrorMessage(undefined, fallback);

    // Assert
    expect(nullResult).toBe(fallback);
    expect(undefinedResult).toBe(fallback);
  });

  it('[getErrorMessage] должен вернуть сообщение, когда ошибка строка или Error', () => {
    // Arrange
    const stringError = 'Plain error';
    const runtimeError = new Error('Runtime error');

    // Act
    const stringResult = getErrorMessage(stringError);
    const errorResult = getErrorMessage(runtimeError);

    // Assert
    expect(stringResult).toBe('Plain error');
    expect(errorResult).toBe('Runtime error');
  });

  it('[getErrorMessage] должен форматировать FastAPI detail, когда Axios ошибка содержит массив валидации', () => {
    // Arrange
    const error = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'username'], msg: 'Field required' },
            { loc: ['body', 'limit'], msg: 'Input should be less than 100' },
          ],
        },
      },
    };

    // Act
    const result = getErrorMessage(error);

    // Assert
    expect(result).toBe('body.username: Field required; body.limit: Input should be less than 100');
  });

  it('[getErrorMessage] должен вернуть detail или message, когда Axios ошибка содержит строковые поля', () => {
    // Arrange
    const detailError = { response: { data: { detail: 'Forbidden' } } };
    const messageError = { response: { data: { message: 'Conflict' } } };
    const stringDataError = { response: { data: 'Raw backend error' } };

    // Act
    const detailResult = getErrorMessage(detailError);
    const messageResult = getErrorMessage(messageError);
    const stringDataResult = getErrorMessage(stringDataError);

    // Assert
    expect(detailResult).toBe('Forbidden');
    expect(messageResult).toBe('Conflict');
    expect(stringDataResult).toBe('Raw backend error');
  });

  it('[getErrorMessage] должен вернуть fallback, когда объект ошибки не содержит читаемого сообщения', () => {
    // Arrange
    const error = { response: { data: { detail: { nested: true } } } };

    // Act
    const result = getErrorMessage(error, 'Unknown');

    // Assert
    expect(result).toBe('Unknown');
  });
});
