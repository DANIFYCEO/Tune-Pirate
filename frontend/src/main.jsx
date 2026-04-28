import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DownloadProvider } from './hooks/useDownload.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
    <DownloadProvider>
      <App />
    </DownloadProvider>
)
