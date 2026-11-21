import { expect, it } from 'vitest';
import { createDb } from '../src/server/db';

it('keeps the writer capability transaction-local without taking the read-only snapshot early',async()=>{
  const db=await createDb(process.env.TEST_DATABASE_URL??'postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test',
    {migrate:false,maxConnections:1});
  const capability=async()=>(await db.prepare("SELECT current_setting('tasktopia.sprint_continuations',true) AS capability").get())?.capability;
  try{
    expect(await capability()).not.toBe('1');
    await db.transaction(async()=>{
      await db.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(await capability()).toBe('1');
      expect(await db.prepare("SELECT current_setting('transaction_read_only') AS readonly").get()).toEqual({readonly:'on'});
    });
    expect(await capability()).not.toBe('1');
    await expect(db.transaction(async()=>{expect(await capability()).toBe('1');throw Error('rollback capability');}))
      .rejects.toThrow('rollback capability');
    expect(await capability()).not.toBe('1');
  }finally{await db.close();}
});

it('observes real pending SQL/pool work and failures without collecting SQL or parameters', async () => {
  const db = await createDb(process.env.TEST_DATABASE_URL ?? 'postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test', { migrate: false, maxConnections: 1 });
  try {
    const initial = db.runtimeMetrics!();
    const first = db.prepare('SELECT pg_sleep(0.03)').get();
    const second = db.prepare('SELECT 1').get();
    expect(db.runtimeMetrics!().inFlight).toBe(2);
    await Promise.all([first, second]);
    await expect(db.prepare('SELECT * FROM runtime_metrics_missing_table').get()).rejects.toThrow();
    const result = db.runtimeMetrics!();
    expect(result).toMatchObject({ inFlight: 0, completed: initial.completed + 3, failed: initial.failed + 1 });
    expect(result.latencyMs.max).toBeGreaterThan(20);
    expect(JSON.stringify(result)).not.toContain('runtime_metrics_missing_table');
  } finally { await db.close(); }
});
