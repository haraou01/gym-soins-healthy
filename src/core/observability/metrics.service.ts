import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { metrics } from './metrics.registry';

@Injectable()
export class MetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async render(): Promise<string> {
    const lines = [metrics.render()];

    try {
      const databaseRows: Array<{
        xact_commit: string;
        xact_rollback: string;
        tup_returned: string;
        tup_fetched: string;
        tup_inserted: string;
        tup_updated: string;
        tup_deleted: string;
      }> = await this.dataSource.query(`
        SELECT xact_commit, xact_rollback,
               tup_returned, tup_fetched,
               tup_inserted, tup_updated, tup_deleted
        FROM pg_stat_database
        WHERE datname = current_database()
      `);

      const db = databaseRows[0];

      if (db) {
        lines.push(`db_transactions_total{type="commit"} ${Number(db.xact_commit)}`);
        lines.push(`db_transactions_total{type="rollback"} ${Number(db.xact_rollback)}`);
        lines.push(`db_tuples_total{type="returned"} ${Number(db.tup_returned)}`);
        lines.push(`db_tuples_total{type="fetched"} ${Number(db.tup_fetched)}`);
        lines.push(`db_tuples_total{type="inserted"} ${Number(db.tup_inserted)}`);
        lines.push(`db_tuples_total{type="updated"} ${Number(db.tup_updated)}`);
        lines.push(`db_tuples_total{type="deleted"} ${Number(db.tup_deleted)}`);
      }

      const connectionRows: Array<{ count: string }> =
        await this.dataSource.query(
          `SELECT COUNT(*)::text AS count FROM pg_stat_activity WHERE datname = current_database()`,
        );
      lines.push(`db_connections ${Number(connectionRows[0]?.count ?? 0)}`);

      const lockRows: Array<{ waiting: string; granted: string }> =
        await this.dataSource.query(`
          SELECT
            COUNT(*) FILTER (WHERE NOT granted)::text AS waiting,
            COUNT(*) FILTER (WHERE granted)::text AS granted
          FROM pg_locks
        `);
      lines.push(`db_locks{state="waiting"} ${Number(lockRows[0]?.waiting ?? 0)}`);
      lines.push(`db_locks{state="granted"} ${Number(lockRows[0]?.granted ?? 0)}`);

      const maxConnectionsRows: Array<{ setting: string }> =
        await this.dataSource.query(
          `SELECT setting FROM pg_settings WHERE name = 'max_connections'`,
        );
      lines.push(
        `db_max_connections ${Number(maxConnectionsRows[0]?.setting ?? 0)}`,
      );

      const sizeRows: Array<{ size: string }> = await this.dataSource.query(
        `SELECT pg_database_size(current_database())::text AS size`,
      );
      lines.push(`db_size_bytes ${Number(sizeRows[0]?.size ?? 0)}`);
    } catch {
      lines.push('db_metrics_available 0');
    }

    try {
      const rows: Array<{ status: string; count: string }> =
        await this.dataSource.query('SELECT status, count FROM outbox_stats_global()');
      const stats: Record<string, number> = {
        PENDING: 0,
        PROCESSING: 0,
        PROCESSED: 0,
        FAILED: 0,
      };

      for (const row of rows) {
        stats[row.status] = Number(row.count);
      }

      lines.push(`outbox_events{status="PENDING"} ${stats.PENDING}`);
      lines.push(`outbox_events{status="PROCESSING"} ${stats.PROCESSING}`);
      lines.push(`outbox_events{status="PROCESSED"} ${stats.PROCESSED}`);
      lines.push(`outbox_events{status="FAILED"} ${stats.FAILED}`);
    } catch {
      lines.push('outbox_metrics_available 0');
    }

    return `${lines.filter(Boolean).join('\n')}\n`;
  }
}
