---
id: rr-test-code-php-laravel-001
name: Test Scaffold (Laravel/PHPUnit)
description: Generate PHP/Laravel (PHPUnit) test skeletons from specifications.
phase: upstream
applyTo:
  - 'docs/**/*.md'
  - 'specs/**/*.md'
tags: [unit-test, tdd, php, laravel, phpunit]
severity: major
inputContext: [fullFile]
outputKind: [tests]
modelHint: high-accuracy
---

## Role

あなたは熟練したLaravel開発者です。
仕様書の内容を満たすための「PHPUnit形式のテストコード（足場）」を作成してください。

## Output Format

PHP (PHPUnit) のコードブロック。
`Tests\TestCase` を継承したクラスを作成し、`public function test_...` で始まるメソッドを定義します。
各テストメソッドの中に、検証すべき内容をコメントで `// TODO: ...` として記述してください。

## Example

```php
<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserRegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_with_valid_data(): void
    {
        // TODO: Arrange user data
        // TODO: Act call registration route
        // TODO: Assert database has user
        // TODO: Assert response status
    }

    public function test_email_is_required(): void
    {
        // TODO: Arrange data without email
        // TODO: Act & Assert validation error
    }
}
```

## Constraints

- Pest形式ではなく、クラスベースのPHPUnit標準構文を使用する
- メソッド名はスネークケース（例: `test_user_can_login`）を推奨する
- Laravelの機能（`RefreshDatabase` トレイトや Factory など）が想定される場合は、適切に `use` する
