# Review Output Examples

River Reviewer が生成するレビュー出力の例です。Summary / Comments / Suggestions を含み、実際の AI レビューに近いトーンで記載しています。

## Upstream (設計フェーズ)

### 対象コード (Upstream)

```typescript
// api/routes/user.ts
router.post('/users', async (req, res) => {
  const user = await userService.create(req.body);
  res.json(user);
});
```

### 生成されるコメント例 (Upstream)

- Summary: 新規ユーザー作成エンドポイントで入力バリデーションとエラーハンドリングが不足しています。ドメイン上の制約が設計ドキュメントと不整合です。
- Comments:
  - api/routes/user.ts:2 入力スキーマが未定義です。設計では email は必須・形式検証ありと記載されています。
  - api/routes/user.ts:3 失敗時に適切なステータスコードを返していません（常に 200）。異常系の設計を反映してください。
- Suggestions:
  - email の形式・必須チェックを設計に合わせて追加する
  - `try/catch` を追加し、422/500 など適切なステータスで返却する
  - サービス層にドメインバリデーションを寄せ、ルートは入力整形のみに留める

```typescript
// api/routes/user.ts
router.post('/users', async (req, res) => {
  try {
    const payload = userSchema.parse(req.body); // zod 等で入力検証
    const user = await userService.create(payload);
    return res.status(201).json(user);
  } catch (err) {
    return res.status(422).json({ message: 'invalid payload', detail: err.message });
  }
});
```

## Midstream (実装フェーズ)

### 対象コード (Midstream)

```tsx
// src/components/ProfileCard.tsx
export const ProfileCard = ({ user }) => (
  <div>
    <p>{user.name}</p>
    <p>Age: {user.age}</p>
    <button onClick={() => alert('clicked')}>Contact</button>
  </div>
);
```

### 生成されるコメント例 (Midstream)

- Summary: `ProfileCard` の型安全性とアクセシビリティに課題があります。クリックイベントがハードコードされており再利用性が低下しています。
- Comments:
  - src/components/ProfileCard.tsx:2 props に型が付与されていません。型定義がないと誤ったプロパティでもコンパイルが通ります。
  - src/components/ProfileCard.tsx:5 アラートのハンドラが固定でテストしづらく、ボタンに `aria-label` がありません。
- Suggestions:
  - `Props` インターフェースを定義し、`user` の構造を明示する
  - ボタンのハンドラを外から注入し、`aria-label` を付与する

```tsx
// src/components/ProfileCard.tsx
type ProfileCardProps = {
  user: { name: string; age: number };
  onContact?: () => void;
};

export const ProfileCard: React.FC<ProfileCardProps> = ({ user, onContact }) => (
  <div>
    <p>{user.name}</p>
    <p>Age: {user.age}</p>
    <button aria-label="contact user" onClick={onContact}>
      Contact
    </button>
  </div>
);
```

## Downstream (テストフェーズ)

### 対象コード (Downstream)

```typescript
// tests/order.spec.ts
describe('Order total', () => {
  it('calculates total', () => {
    const order = new Order([{ price: 1000 }, { price: 2000 }]);
    expect(order.total()).toBeGreaterThan(0);
  });
});
```

### 生成されるコメント例 (Downstream)

- Summary: テストが成功条件のみを検証しており、境界・失敗ケースが欠落しています。具体的な期待値がなく、リグレッションを検知できません。
- Comments:
  - tests/order.spec.ts:3 具体的な期待値が無く、値の誤差を検出できません。
  - tests/order.spec.ts:4 割引・送料・空配列などのケースがカバーされていません。要件の抜け漏れを見逃す恐れがあります。
- Suggestions:
  - 期待値を固定値で比較し、合計計算ロジックの regressions を検知する
  - 空カート・割引適用・不正入力のケースを追加する

```typescript
// tests/order.spec.ts
describe('Order total', () => {
  it('calculates total with items', () => {
    const order = new Order([{ price: 1000 }, { price: 2000 }]);
    expect(order.total()).toBe(3000);
  });

  it('returns zero for empty cart', () => {
    const order = new Order([]);
    expect(order.total()).toBe(0);
  });

  it('applies discount', () => {
    const order = new Order([{ price: 1000 }], { discountRate: 0.1 });
    expect(order.total()).toBe(900);
  });
});
```
