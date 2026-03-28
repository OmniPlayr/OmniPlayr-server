import './styles/Login.css'
import { makeToast } from '@wokki20/jspt';
import '@wokki20/jspt/dist/jspt.css';
import { useNavigate } from 'react-router-dom'

function Login() {
	const navigate = useNavigate()

	async function handleSubmit() {
		const password = (document.querySelector('.login__input') as HTMLInputElement).value;
		const response = await fetch('http://localhost:8000/api/server/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ password })
		});
		const data = await response.json();
		if (data.status === 'success') {
			localStorage.setItem('access_token', data.access_token);
			localStorage.setItem('refresh_token', data.refresh_token);
			localStorage.setItem('access_token_expires', data.access_token_expires);
			localStorage.setItem('refresh_token_expires', data.refresh_token_expires);
			makeToast({
				message: 'Logged in successfully!',
				style: 'default',
				icon_left: 'check',
				icon_left_type: 'google_material_rounded',
				duration: 5000
			})
			navigate('/')
		} else {
			makeToast({
				message: data.detail,
				style: 'default-error',
				icon_left: 'error',
				icon_left_type: 'google_material_rounded',
				duration: -1
			})
		}
	}

	return (
		<>
		<div className='login__screen'>
			<h1 className='login__title'>Login</h1>
			<p className='login__subtitle'>Please enter the server password to continue</p>
			<input className='login__input' type="password" placeholder="Password" />
			<button className='login__button' data-type="primary" onClick={handleSubmit}>Login</button>
		</div>
		</>
	)
}

export default Login