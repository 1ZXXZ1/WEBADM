import { describe, expect, it } from 'vitest';
import {
  diagnoseAPIError,
  extractResponseData,
  formatValidationErrors,
  isAPIError,
  isNonEmptyString,
  isObject,
  parseTextOutput,
  safeArray,
  safeNumber,
  safeString,
  validateAPIResponse,
} from './api-types';

describe('api-types', () => {
  it('[isObject] должен распознать объект, когда значение не null и не массив', () => {
    // Arrange
    const value = { id: 1 };

    // Act
    const result = isObject(value);
    const nullResult = isObject(null);
    const arrayResult = isObject([]);

    // Assert
    expect(result).toBe(true);
    expect(nullResult).toBe(false);
    expect(arrayResult).toBe(false);
  });

  it('[isAPIError] должен распознать API ошибку, когда status error и detail строка', () => {
    // Arrange
    const apiError = { status: 'error', detail: 'Denied' };

    // Act
    const result = isAPIError(apiError);
    const invalidResult = isAPIError({ status: 'error', detail: null });

    // Assert
    expect(result).toBe(true);
    expect(invalidResult).toBe(false);
  });

  it('[isNonEmptyString] должен вернуть true, когда строка содержит непустой текст', () => {
    // Arrange
    const value = ' admin ';

    // Act
    const result = isNonEmptyString(value);
    const emptyResult = isNonEmptyString('   ');

    // Assert
    expect(result).toBe(true);
    expect(emptyResult).toBe(false);
  });

  it('[safeString] должен безопасно привести значение к строке, когда вход примитив или массив', () => {
    // Arrange
    const fallback = 'fallback';

    // Act
    const nullResult = safeString(null, fallback);
    const numberResult = safeString(Number.MAX_SAFE_INTEGER);
    const booleanResult = safeString(false);
    const arrayResult = safeString(['a', 0, null]);
    const objectResult = safeString({ a: 1 }, fallback);

    // Assert
    expect(nullResult).toBe(fallback);
    expect(numberResult).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(booleanResult).toBe('false');
    expect(arrayResult).toBe('a, 0, ');
    expect(objectResult).toBe(fallback);
  });

  it('[safeNumber] должен безопасно привести значение к числу, когда вход строка, число или некорректное значение', () => {
    // Arrange
    const fallback = 7;

    // Act
    const numberResult = safeNumber(0, fallback);
    const stringResult = safeNumber('42', fallback);
    const invalidResult = safeNumber('', fallback);
    const objectResult = safeNumber({}, fallback);

    // Assert
    expect(numberResult).toBe(0);
    expect(stringResult).toBe(42);
    expect(invalidResult).toBe(0);
    expect(objectResult).toBe(fallback);
  });

  it('[safeArray] должен вернуть массив, когда вход массив или другое значение', () => {
    // Arrange
    const value = ['admin'];

    // Act
    const arrayResult = safeArray<string>(value);
    const invalidResult = safeArray<string>(undefined);

    // Assert
    expect(arrayResult).toEqual(value);
    expect(invalidResult).toEqual([]);
  });

  it('[parseTextOutput] должен вернуть непустые строки, когда output строка или объект с output', () => {
    // Arrange
    const text = 'one\n\n two ';
    const object = { output: text };

    // Act
    const stringResult = parseTextOutput(text);
    const objectResult = parseTextOutput(object);
    const invalidResult = parseTextOutput(null);

    // Assert
    expect(stringResult).toEqual(['one', ' two ']);
    expect(objectResult).toEqual(['one', ' two ']);
    expect(invalidResult).toEqual([]);
  });

  it('[validateAPIResponse] должен вернуть ошибки, когда формат ответа не совпадает с ожидаемым', () => {
    // Arrange
    const invalidArrayResponse = { items: [] };
    const invalidPaginatedResponse = { data: {}, total: '10' };

    // Act
    const nullErrors = validateAPIResponse(null, 'object', 'user');
    const arrayErrors = validateAPIResponse(invalidArrayResponse, 'array', 'users');
    const paginatedErrors = validateAPIResponse(invalidPaginatedResponse, 'paginated', 'page');

    // Assert
    expect(nullErrors).toHaveLength(1);
    expect(arrayErrors[0]).toMatchObject({ path: 'users.data', expected: 'array' });
    expect(paginatedErrors).toHaveLength(2);
  });

  it('[validateAPIResponse] должен не возвращать ошибки, когда допустимы direct array, wrapped array и output', () => {
    // Arrange
    const directArray = ['admin'];
    const wrappedArray = { data: ['admin'] };
    const output = { output: 'admin' };

    // Act
    const directErrors = validateAPIResponse(directArray, 'array');
    const wrappedErrors = validateAPIResponse(wrappedArray, 'array');
    const outputErrors = validateAPIResponse(output, 'array');

    // Assert
    expect(directErrors).toEqual([]);
    expect(wrappedErrors).toEqual([]);
    expect(outputErrors).toEqual([]);
  });

  it('[extractResponseData] должен извлечь данные, когда ответ direct, wrapped, result или output', () => {
    // Arrange
    const parser = (raw: unknown) => (raw as string[]).map((name) => ({ parsed: name.trim() }));

    // Act
    const directResult = extractResponseData<string>(['a']);
    const wrappedResult = extractResponseData<string>({ data: ['b'] });
    const resultResult = extractResponseData<string>({ result: ['c'] });
    const outputResult = extractResponseData<{ parsed: string }>({ output: 'd\n' }, parser);
    const nestedOutputResult = extractResponseData<{ name: string }>({ data: { output: 'e\nf' } });
    const invalidResult = extractResponseData(null);

    // Assert
    expect(directResult).toEqual(['a']);
    expect(wrappedResult).toEqual(['b']);
    expect(resultResult).toEqual(['c']);
    expect(outputResult).toEqual([{ parsed: 'd' }]);
    expect(nestedOutputResult).toEqual([{ name: 'e' }, { name: 'f' }]);
    expect(invalidResult).toEqual([]);
  });

  it('[formatValidationErrors] должен отформатировать ошибки, когда передан список ValidationError', () => {
    // Arrange
    const errors = [
      { path: 'data', expected: 'array', received: 'object', message: 'data: expected array' },
      { path: 'total', expected: 'number', received: 'string', message: 'total: expected number' },
    ];

    // Act
    const result = formatValidationErrors(errors);

    // Assert
    expect(result).toBe('[data] data: expected array\n[total] total: expected number');
  });

  it('[diagnoseAPIError] должен диагностировать ошибку, когда вход APIError, Axios-like объект, Error или primitive', () => {
    // Arrange
    const apiError = { status: 'error', detail: 'Denied', error_code: 'DENIED', rc: 403 };
    const axiosError = { response: { status: 500, data: { message: 'Backend failed' } } };
    const plainError = new Error('Runtime failed');

    // Act
    const apiResult = diagnoseAPIError(apiError);
    const axiosResult = diagnoseAPIError(axiosError);
    const errorResult = diagnoseAPIError(plainError);
    const primitiveResult = diagnoseAPIError(undefined);

    // Assert
    expect(apiResult).toEqual({ message: 'Denied', code: 'DENIED', statusCode: 403 });
    expect(axiosResult).toEqual({ message: 'Backend failed', statusCode: 500 });
    expect(errorResult).toEqual({ message: 'Runtime failed' });
    expect(primitiveResult).toEqual({ message: 'undefined' });
  });
});
