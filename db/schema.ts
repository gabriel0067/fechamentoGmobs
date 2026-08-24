import { primaryKey, sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const cloudStateChunks = sqliteTable(
  "cloud_state_chunks",
  {
    ownerId: text("owner_id").notNull(),
    stateKey: text("state_key").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    encoding: text("encoding").notNull(),
    payload: text("payload").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.ownerId, table.stateKey, table.chunkIndex],
    }),
  ],
);
