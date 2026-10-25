import { KdsEventsService } from '../src/modules/healthy_food/services/kds-events.service';

describe('KdsEventsService — activation explicite', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function createService(enabled: boolean) {
    const dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'KDS_EVENTS_ENABLED' ? enabled : undefined,
      ),
    };

    return {
      service: new KdsEventsService(
        dataSource as never,
        configService as never,
      ),
      dataSource,
    };
  }

  it('démarre le polling lorsque KDS_EVENTS_ENABLED=true', async () => {
    const { service, dataSource } = createService(true);

    service.onModuleInit();
    expect((service as unknown as { timer?: NodeJS.Timeout }).timer).toBeDefined();

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('list_kds_outbox_events'),
      expect.any(Array),
    );

    service.onModuleDestroy();
  });

  it('ne démarre aucun polling lorsque KDS_EVENTS_ENABLED=false', async () => {
    const { service, dataSource } = createService(false);

    service.onModuleInit();
    expect(
      (service as unknown as { timer?: NodeJS.Timeout }).timer,
    ).toBeUndefined();

    jest.advanceTimersByTime(5_000);
    await Promise.resolve();

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(service.getPollErrors()).toBe(0);

    service.onModuleDestroy();
  });
});
