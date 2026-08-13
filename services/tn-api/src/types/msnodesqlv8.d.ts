declare module 'msnodesqlv8' {
  export type NativeConnection = {
    promises: {
      query: (sql: string, parameters?: unknown[]) => Promise<unknown>;
      close: () => Promise<void>;
    };
  };

  const sql: {
    promises: {
      open: (connectionString: string) => Promise<NativeConnection>;
    };
  };

  export = sql;
}
