import { Link } from 'react-router-dom';
import { Clapperboard, Github, ShieldCheck } from 'lucide-react';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <span className="brand-mark">
            <Clapperboard size={18} />
          </span>
          <div>
            <strong>影巢 CineNest</strong>
            <p>豆瓣元数据 + 可插拔网盘检索。资源链接均来自公开搜索结果，本站不存储任何视频文件。</p>
          </div>
        </div>
        <div className="footer-links">
          <Link to="/settings">渠道设置</Link>
          <a href="https://movie.douban.com/" target="_blank" rel="noreferrer">
            豆瓣电影
          </a>
          <a href="https://github.com/fish2018/pansou" target="_blank" rel="noreferrer">
            <Github size={14} />
            PanSou
          </a>
          <span className="footer-safe">
            <ShieldCheck size={14} />
            请支持正版
          </span>
        </div>
      </div>
    </footer>
  );
}
