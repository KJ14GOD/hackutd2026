// Sends a segmentation result to the loadSegmentation reducer, which replaces the previous one.
import { connectStdb } from '@theseus/shared';
import type { SegmentationResult } from './types';

export async function publishSegmentation(result: SegmentationResult): Promise<void> {
  const conn = await connectStdb();
  try {
    await conn.reducers.loadSegmentation({ json: JSON.stringify(result) });
  } finally {
    conn.disconnect();
  }
}
