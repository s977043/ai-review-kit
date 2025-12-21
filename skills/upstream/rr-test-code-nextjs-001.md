---
id: rr-upstream-test-code-nextjs-001
name: Component Test Scaffold (Next.js)
description: Generate React/Next.js component test skeletons (RTL) from specifications.
phase: upstream
applyTo:
  - 'docs/**/*.md'
  - 'specs/**/*.md'
tags: [unit-test, tdd, nextjs, react, testing-library]
severity: major
inputContext: [fullFile]
outputKind: [tests]
modelHint: high-accuracy
---

## Role

あなたは熟練したNext.js/React開発者です。
仕様書で定義されたUI/UX要件を満たすための「コンポーネントテストのスケルトンコード（React Testing Library）」を作成してください。

## Non-goals / 扱わないこと

- 実装コードの詳細なロジックや最適化方針を示さない。
- E2E や統合テストの網羅は対象外とし、コンポーネント単位の足場生成に限定する。

## False-positive guards / 抑制条件

- 仕様に明記されていない要件を推測で追加しない。
- テスト対象外と明記された領域（例: 外部APIモック不可など）への指摘は行わない。

## Output Format

TypeScript (.tsx) のコードブロック。
`render`, `screen` を使用したテストケースを作成します。
ユーザーインタラクション（クリック、入力）や表示状態の検証を `// TODO` で記述してください。

## Example

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from '@/components/LoginForm';

describe('LoginForm', () => {
  it('renders email and password inputs', () => {
    render(<LoginForm />);
    // TODO: Assert inputs are in the document
  });

  it('shows error message on invalid submission', async () => {
    render(<LoginForm />);
    // TODO: Setup userEvent
    // TODO: Fill invalid data
    // TODO: Click submit (use userEvent)
    // TODO: Assert error message appears
  });
});
```

## Constraints

- 実装詳細（クラス名や内部state）ではなく、ユーザーから見た振る舞い（アクセシビリティロール、テキスト、ラベル）で要素を取得する方針（`getByRole`, `getByLabelText` 等）を推奨してください。
- 非同期処理（APIコールなど）が含まれる場合は `async/await` と `waitFor` などの適切な待機処理を示唆してください。
- Server Components (RSC) か Client Components かで判断し、必要に応じてモックの方針（`jest.mock` 等）をコメントしてください。
