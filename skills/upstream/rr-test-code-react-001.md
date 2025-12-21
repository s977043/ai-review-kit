---
id: rr-upstream-test-code-react-001
name: Component Test Scaffold (React)
description: Generate generic React component test skeletons (RTL) from specifications.
phase: upstream
applyTo:
  - 'docs/**/*.md'
  - 'specs/**/*.md'
tags: [unit-test, tdd, react, testing-library, vite]
severity: major
inputContext: [fullFile]
outputKind: [tests]
modelHint: high-accuracy
---

## Role

あなたは熟練したReact開発者です。
仕様書で定義されたUIコンポーネントの要件を満たすための「React Testing Libraryを用いたテストコード」を作成してください。

## Output Format

TypeScript (.tsx) のコードブロック。
`render`, `screen`, `userEvent` を使用したテストケースを作成します。
フレームワーク（Next.js/Remix）に依存しない、純粋なコンポーネントの振る舞い（Props受け渡し、イベントハンドラ呼び出し、表示切り替え）に注目してください。

## Example

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('calls onClick handler when clicked', async () => {
    const handleClick = vi.fn(); // or jest.fn()
    render(<Button onClick={handleClick}>Click Me</Button>);

    await userEvent.click(screen.getByRole('button', { name: /click me/i }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

## Constraints

- `getByRole`, `getByLabelText` などのアクセシビリティを意識したクエリを優先してください。
- `userEvent` を使用して、実際のユーザー操作に近いイベント発火を行ってください。
- テストランナーは Vitest または Jest どちらでも動作する標準的な書き方を心がけてください。
