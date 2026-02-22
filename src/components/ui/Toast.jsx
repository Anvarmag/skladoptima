import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'error') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    }, []);

    return (
        <ToastContext.Provider value={addToast}>
            {children}
            <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        className={`px-4 py-3 rounded-lg shadow-lg text-sm text-white flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 ${t.type === 'error' ? 'bg-red-500' :
                                t.type === 'success' ? 'bg-green-500' : 'bg-blue-500'
                            }`}
                    >
                        {t.type === 'error' ? '❌' : t.type === 'success' ? '✅' : 'ℹ️'}
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
};
