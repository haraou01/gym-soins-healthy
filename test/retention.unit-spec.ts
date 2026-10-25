import { RetentionService } from '../src/core/retention/retention.service';

describe('RetentionService — purge fonctionnelle', () => {
  it('exécute les deux purges et agrège les résultats', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ deleted: 2 }])
        .mockResolvedValueOnce([{ deleted: 3 }]),
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'RETENTION_PURGE_MAX_BATCHES') return 1;
        return undefined;
      }),
    };

    const service = new RetentionService(
      dataSource as never,
      configService as never,
    );

    await expect(service.runAll()).resolves.toEqual({
      idempotencyKeysPurged: 2,
      outboxEventsPurged: 3,
    });

    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('purge_idempotency_batch'),
      expect.any(Array),
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('purge_outbox_batch'),
      expect.any(Array),
    );
  });
});
