import { describe, expect, it } from 'vitest';
import { API_OPERATIONS, CATEGORIES } from './api-operations';

describe('api-operations', () => {
  it('[API_OPERATIONS] должен содержать уникальные методы, когда загружен каталог операций', () => {
    // Arrange
    const methods = API_OPERATIONS.map((operation) => operation.method);

    // Act
    const uniqueMethods = new Set(methods);

    // Assert
    expect(uniqueMethods.size).toBe(methods.length);
    expect(methods).toContain('user.list.full');
    expect(methods).toContain('batch.execute');
  });

  it('[API_OPERATIONS] должен ссылаться только на существующие категории, когда операция имеет category', () => {
    // Arrange
    const categoryIds = new Set(CATEGORIES.map((category) => category.id));

    // Act
    const unknownCategories = API_OPERATIONS
      .map((operation) => operation.category)
      .filter((category) => !categoryIds.has(category));

    // Assert
    expect(unknownCategories).toEqual([]);
  });

  it('[API_OPERATIONS] должен иметь валидные параметры, когда параметр помечен required или имеет options', () => {
    // Arrange
    const invalidParams = API_OPERATIONS.flatMap((operation) =>
      operation.params.map((param) => ({
        method: operation.method,
        name: param.name,
        label: param.label,
        type: param.type,
        required: param.required,
        options: param.options,
      }))
    ).filter((param) => {
      const hasBaseFields = Boolean(param.name && param.label && param.type);
      const selectHasOptions = param.type !== 'select' || (Array.isArray(param.options) && param.options.length > 0);
      const requiredIsBoolean = param.required === undefined || typeof param.required === 'boolean';
      return !hasBaseFields || !selectHasOptions || !requiredIsBoolean;
    });

    // Act
    const result = invalidParams;

    // Assert
    expect(result).toEqual([]);
  });

  it('[CATEGORIES] должен содержать уникальные идентификаторы, когда загружен справочник категорий', () => {
    // Arrange
    const ids = CATEGORIES.map((category) => category.id);

    // Act
    const uniqueIds = new Set(ids);

    // Assert
    expect(uniqueIds.size).toBe(ids.length);
    expect(ids).toContain('users');
    expect(ids).toContain('management');
  });
});
