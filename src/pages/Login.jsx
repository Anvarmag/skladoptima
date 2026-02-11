import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Box } from 'lucide-react';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const login = useAuthStore((state) => state.login);
    const navigate = useNavigate();

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!email || !password) {
            setError('Please fill in all fields');
            return;
        }

        if (login(email, password)) {
            navigate('/app/stocks');
        } else {
            setError('Invalid credentials');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-lg border-gray-200">
                <CardHeader className="text-center pb-2">
                    <div className="mx-auto w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-4 shadow-lg shadow-blue-200">
                        <Box size={28} />
                    </div>
                    <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">
                        Skladoptima
                    </CardTitle>
                    <p className="text-gray-500 mt-2 text-sm">Enter admin / 1234 to access the system</p>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Input
                            label="Login"
                            type="text"
                            placeholder="admin"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            error={error && !email ? 'Required' : ''}
                            autoFocus
                        />
                        <Input
                            label="Password"
                            type="password"
                            placeholder="1234"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            error={error && !password ? 'Required' : ''}
                        />

                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full mt-2 shadow-lg shadow-blue-100" size="lg">
                            Sign In
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

export default Login;
