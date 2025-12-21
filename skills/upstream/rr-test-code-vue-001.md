---
id: rr-test-code-vue-001
name: Component Test Scaffold (Vue.js)
description: Generate Vue.js component test skeletons (Vue Test Utils) from specifications.
phase: upstream
applyTo:
  - 'docs/**/*.md'
  - 'specs/**/*.md'
tags: [unit-test, tdd, vue, vitest, vue-test-utils]
severity: major
inputContext: [fullFile]
outputKind: [tests]
modelHint: high-accuracy
---

## Role

あなたは熟練したVue.js開発者です。
仕様書で定義されたUI/UX要件を満たすための「コンポーネントテストのスケルトンコード（Vue Test Utils）」を作成してください。

## Output Format

TypeScript/JavaScript のコードブロック。
`mount` または `shallowMount` を使用したテストケースを作成します。
`describe` ブロックで構成し、各テストケース (`it`) 内に `// TODO` で検証ステップを記述してください。

## Example

```typescript
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import UserProfile from '@/components/UserProfile.vue';

describe('UserProfile.vue', () => {
  it('renders user name when passed via props', () => {
    // TODO: Arrange (mount component with props)
    // const wrapper = mount(UserProfile, { props: { name: 'Alice' } })
    // TODO: Assert text content
    // expect(wrapper.text()).toContain('Alice')
  });

  it('emits "update" event on button click', async () => {
    // TODO: Arrange & Act (find button and trigger click)
    // await wrapper.find('button').trigger('click')
    // TODO: Assert event emission
    // expect(wrapper.emitted()).toHaveProperty('update')
  });
});
```

## Constraints

- テストランナーは **Vitest** を想定してください（Jestの場合はその旨をコメントで補足）。
- コンポーネントの `props`、`slots`、`emit` イベントの検証を重点的に洗い出してください。
- 非同期更新（`nextTick` や `await trigger`）が必要な操作については適切な `async/await` 構文を使用してください。
