import { FIXTURES_DIR, makeFixtureImages } from '../fixtures/makeImages';

// 跑端到端测试前生成 tests/fixtures/images/ 里的测试图片
export default async function globalSetup() {
  await makeFixtureImages(FIXTURES_DIR);
}
