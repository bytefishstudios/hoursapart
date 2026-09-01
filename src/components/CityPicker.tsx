import { useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, searchCities, type City } from '../lib/time/cities';
import { formatOffset, offsetMinutes } from '../lib/time/zone';

/** Shared between the clock and the planner, so both search the same way. */
export default function CityPicker({
  onAdd,
  placeholder = 'Add a city — try LAX, Bangalore, sao paulo',
}: {
  onAdd: (city: City) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => (query ? searchCities(query) : CITIES.slice(0, 6)), [query]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function choose(city: City) {
    onAdd(city);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && results[highlight]) {
            choose(results[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label="Add a city"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="ring-focus w-full rounded-xl border border-dashed border-paper-300 bg-white px-4 py-2.5 text-sm placeholder:text-paper-500"
      />

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-paper-200 bg-white py-1 shadow-lg"
        >
          {results.map((city, i) => (
            <li key={`${city.name}-${city.timeZone}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(city)}
                className={`flex w-full items-baseline justify-between gap-3 px-4 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-paper-100' : ''
                }`}
              >
                <span>
                  {city.name}
                  <span className="ml-2 text-xs text-paper-500">{city.country}</span>
                </span>
                <span className="nums text-[10px] text-paper-500">
                  {formatOffset(offsetMinutes(new Date(), city.timeZone))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
