export interface RiverReviewerConfig {
  /** AIモデルの設定 */
  model: {
    provider: 'google' | 'openai' | 'anthropic';
    modelName: string;
    temperature?: number;
    maxTokens?: number;
  };

  /** レビューの振る舞い */
  review: {
    language: 'ja' | 'en';
    /** 指摘の厳格度: 'strict' (細かい指摘) | 'normal' | 'relaxed' (致命的なもののみ) */
    severity: 'strict' | 'normal' | 'relaxed';
    /** プロジェクト固有の追加指示 (例: "アクセシビリティを重視して") */
    additionalInstructions?: string[];
  };

  /** 対象外の設定 */
  exclude: {
    /** レビューから除外するファイルパスのパターン (glob) */
    files: string[];
    /** 特定のキーワードを含むPRはスキップする */
    prLabelsToIgnore?: string[];
  };
}
