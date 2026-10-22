import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { api } from '../api';
import { setPlayBaseUrl } from '../api';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, location.search]);

  // 初始化播放基础 URL
  useEffect(() => {
    let cancelled = false;
    api<{ playBaseUrl: string; playProxyMode: string }>('/api/config')
      .then((data) => {
        if (!cancelled && data.playBaseUrl) {
          setPlayBaseUrl(data.playBaseUrl);
        }
      })
      .catch(() => {
        // 忽略错误，使用默认 origin
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">{children}</main>
      <Footer />
    </div>
  );
}
