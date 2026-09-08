/** Explain task identity separately from workflow and incident markers. */
export function MapLegend() {
  return <details className="map-legend">
    <summary aria-label="Обозначения карты" title="Обозначения карты">?</summary>
    <div className="map-legend-panel">
      <strong>Обозначения карты</strong>
      <p>Номер на участке — номер задачи. Табличка квартала — количество задач в нём.</p>
      <p>Цвет рамки номера показывает стадию: фиолетовый — планирование, охра — начало, жёлтый — работа, голубой — проверка, зелёный — завершено.</p>
      <dl><dt>!</dt><dd>Есть ошибка или срочное исправление</dd><dt>⚒</dt><dd>Исправление в работе</dd><dt>⌛</dt><dd>Исправление проверяется</dd></dl>
      <p>Наведите на участок, чтобы увидеть название задачи, статус и прогресс. «Районы» показывает границы спринтов.</p>
    </div>
  </details>;
}
