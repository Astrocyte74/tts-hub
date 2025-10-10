interface TextWorkbenchProps {
  text: string;
  onChange: (value: string) => void;
  onInsertRandom: () => void;
  onAppendRandom: () => void;
  isRandomLoading: boolean;
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
}

export function TextWorkbench({
  text,
  onChange,
  onInsertRandom,
  onAppendRandom,
  isRandomLoading,
  categories,
  selectedCategory,
  onCategoryChange,
}: TextWorkbenchProps) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">Script</h2>
        <div className="panel__actions">
          <label className="select">
            <span className="select__label">Random category</span>
            <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <button className="panel__button" type="button" onClick={onInsertRandom} disabled={isRandomLoading}>
            {isRandomLoading ? 'Fetching…' : 'Insert random'}
          </button>
          <button className="panel__button panel__button--ghost" type="button" onClick={onAppendRandom} disabled={isRandomLoading}>
            {isRandomLoading ? 'Fetching…' : 'Append random'}
          </button>
        </div>
      </header>
      <textarea
        className="textarea"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type or paste the script you want to synthesise…"
        rows={8}
      />
    </section>
  );
}

