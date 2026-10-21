import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Clapperboard, Menu, Search, Settings2, X } from 'lucide-react';

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/movies', label: '电影' },
  { to: '/tv', label: '剧集' },
  { to: '/search', label: '搜索' },
];

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setQuery(params.get('q') || '');
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    navigate(`/search?q=${encodeURIComponent(value)}`);
    inputRef.current?.blur();
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="影巢首页">
          <span className="brand-mark">
            <Clapperboard size={21} />
          </span>
          <span className="brand-text">
            <strong>影巢</strong>
            <em>CINENEST</em>
          </span>
        </Link>

        <nav className={`main-nav ${open ? 'is-open' : ''}`}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          <form className="header-search" onSubmit={submit}>
            <Search size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索电影、剧集"
              aria-label="搜索电影、剧集"
            />
            <kbd>/</kbd>
          </form>
          <Link to="/settings" className="icon-btn header-settings" aria-label="设置">
            <Settings2 size={19} />
          </Link>
          <button
            type="button"
            className="icon-btn mobile-menu-btn"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? '关闭菜单' : '打开菜单'}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}
