import { afterAll, afterEach, beforeEach } from "bun:test";
import {
  assertNoTempDirectoryLeaks,
  beginTestCleanupScope,
  cleanupAll,
  cleanupTest,
} from "./cleanup";

beforeEach(beginTestCleanupScope);

afterEach(cleanupTest);

afterAll(() => {
  cleanupAll();
  assertNoTempDirectoryLeaks();
});
