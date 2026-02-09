import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Transcribe from './pages/Transcribe'
import Auth from './pages/Auth'

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/transcribe" element={<Transcribe />} />
                <Route path="/auth" element={<Auth />} />
            </Routes>
        </BrowserRouter>
    )
}
