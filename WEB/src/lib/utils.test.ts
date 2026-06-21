import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('utils', () => {
  it('[cn] должен объединить классы и разрешить Tailwind конфликт, когда переданы строки и условия', () => {
    // Arrange
    const enabled = true;

    // Act
    const result = cn('px-2 py-1', enabled && 'px-4', null, undefined, 'text-sm');

    // Assert
    expect(result).toBe('py-1 px-4 text-sm');
  });

  it('[cn] должен вернуть пустую строку, когда вход пустой или falsy', () => {
    // Arrange
    const values = [null, undefined, false, ''];

    // Act
    const result = cn(...values);

    // Assert
    expect(result).toBe('');
  });
});
