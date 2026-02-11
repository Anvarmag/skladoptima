import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Stocks from './pages/Stocks';
import Settings from './pages/Settings';
import { MainLayout } from './components/layout/MainLayout';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />

                <Route path="/app" element={<MainLayout />}>
                    <Route path="stocks" element={<Stocks />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="" element={<Navigate to="stocks" replace />} />
                </Route>

                <Route path="/" element={<Navigate to="/app/stocks" replace />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
