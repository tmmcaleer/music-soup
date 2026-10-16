jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
}));

const {
  NotionOperationError,
  isRetryableNotionError,
  withNotionRetry,
} = require('../utils/notionRetry');

describe('Notion retry policy', () => {
  test('retries a rate-limited read and honors Retry-After', async () => {
    const rateLimitError = Object.assign(new Error('slow down'), {
      code: 'rate_limited',
      headers: { get: jest.fn(() => '1.25') },
    });
    const operation = jest.fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ results: [] });
    const sleepFn = jest.fn().mockResolvedValue();

    await expect(withNotionRetry('catalog snapshot', operation, {
      mode: 'read',
      maxAttempts: 3,
      sleepFn,
    })).resolves.toEqual({ results: [] });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(1250);
  });

  test('retries an explicitly rate-limited create', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('slow down'), { code: 'rate_limited' }))
      .mockResolvedValueOnce({ id: 'new-page' });

    await expect(withNotionRetry('create track', operation, {
      mode: 'create',
      maxAttempts: 2,
      baseDelayMs: 1,
      sleepFn: jest.fn().mockResolvedValue(),
    })).resolves.toEqual({ id: 'new-page' });

    expect(operation).toHaveBeenCalledTimes(2);
  });

  test('fails closed without retrying an ambiguous create timeout', async () => {
    const timeoutError = Object.assign(new Error('request timed out'), {
      code: 'notionhq_client_request_timeout',
    });
    const operation = jest.fn().mockRejectedValue(timeoutError);
    const sleepFn = jest.fn().mockResolvedValue();

    await expect(withNotionRetry('create track', operation, {
      mode: 'create',
      maxAttempts: 4,
      sleepFn,
    })).rejects.toMatchObject({
      name: 'NotionOperationError',
      cause: timeoutError,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  test('does not retry validation failures', async () => {
    const operation = jest.fn().mockRejectedValue(
      Object.assign(new Error('invalid property'), { code: 'validation_error' })
    );

    await expect(withNotionRetry('catalog snapshot', operation, {
      mode: 'read',
      maxAttempts: 4,
      sleepFn: jest.fn().mockResolvedValue(),
    })).rejects.toBeInstanceOf(NotionOperationError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(isRetryableNotionError({ code: 'validation_error' }, 'read')).toBe(false);
  });

  test('propagates a fatal wrapped error after retries are exhausted', async () => {
    const operation = jest.fn().mockRejectedValue(
      Object.assign(new Error('service unavailable'), { code: 'service_unavailable' })
    );

    await expect(withNotionRetry('catalog snapshot', operation, {
      mode: 'read',
      maxAttempts: 3,
      baseDelayMs: 1,
      sleepFn: jest.fn().mockResolvedValue(),
    })).rejects.toMatchObject({
      name: 'NotionOperationError',
      code: 'service_unavailable',
    });

    expect(operation).toHaveBeenCalledTimes(3);
  });
});
